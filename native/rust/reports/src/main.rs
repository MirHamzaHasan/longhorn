use axum::{
    body::to_bytes,
    extract::{Request, State},
    http::{header, Method, StatusCode},
    response::{IntoResponse, Response},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    env,
    net::{IpAddr, SocketAddr},
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};
use subtle::ConstantTimeEq;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

const PROTOCOL: &str = "longhorn.reports.v1";
const BODY_LIMIT: usize = 65_536;

struct Service {
    token: String,
    permits: Arc<Semaphore>,
    timeout: Duration,
    draining: AtomicBool,
    active: AtomicUsize,
    accepted: AtomicU64,
    completed: AtomicU64,
    rejected: AtomicU64,
}
struct Accepted {
    service: Arc<Service>,
    _permit: OwnedSemaphorePermit,
}
impl Drop for Accepted {
    fn drop(&mut self) {
        self.service.active.fetch_sub(1, Ordering::SeqCst);
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    numbers: Vec<f64>,
}
#[derive(Serialize, Debug, PartialEq)]
struct Report {
    count: usize,
    sum: f64,
    min: f64,
    max: f64,
}

fn compute(input: Input) -> Option<Report> {
    if input.numbers.is_empty()
        || input.numbers.len() > 1000
        || input
            .numbers
            .iter()
            .any(|n| !n.is_finite() || n.abs() > 1e12)
    {
        return None;
    }
    let zero = |value: f64| if value == 0.0 { 0.0 } else { value };
    Some(Report {
        count: input.numbers.len(),
        sum: zero(input.numbers.iter().fold(0.0, |a, b| a + b)),
        min: zero(input.numbers.iter().copied().fold(f64::INFINITY, f64::min)),
        max: zero(
            input
                .numbers
                .iter()
                .copied()
                .fold(f64::NEG_INFINITY, f64::max),
        ),
    })
}

fn failure(status: StatusCode, code: &'static str) -> Response {
    (status, Json(json!({"error": code}))).into_response()
}
fn authenticated(request: &Request, token: &str) -> bool {
    let mut headers = request.headers().get_all(header::AUTHORIZATION).iter();
    let Some(value) = headers.next() else {
        return false;
    };
    if headers.next().is_some() {
        return false;
    }
    let Ok(value) = value.to_str() else {
        return false;
    };
    let Some(supplied) = value.strip_prefix("Bearer ") else {
        return false;
    };
    supplied.as_bytes().ct_eq(token.as_bytes()).into()
}
async fn report(request: Request) -> Response {
    let media = request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim();
    if !media.eq_ignore_ascii_case("application/json")
        || request.headers().contains_key(header::CONTENT_ENCODING)
    {
        return failure(StatusCode::UNSUPPORTED_MEDIA_TYPE, "media");
    }
    let bytes = match to_bytes(request.into_body(), BODY_LIMIT).await {
        Ok(bytes) => bytes,
        Err(_) => return failure(StatusCode::PAYLOAD_TOO_LARGE, "body"),
    };
    let Ok(input) = serde_json::from_slice::<Input>(&bytes) else {
        return failure(StatusCode::BAD_REQUEST, "input");
    };
    let Some(value) = compute(input) else {
        return failure(StatusCode::BAD_REQUEST, "input");
    };
    Json(json!({"protocol": PROTOCOL, "report": value})).into_response()
}
async fn dispatch(State(service): State<Arc<Service>>, request: Request) -> Response {
    let mut response = if !authenticated(&request, &service.token) {
        failure(StatusCode::UNAUTHORIZED, "unauthorized")
    } else if request.uri().query().is_some() {
        failure(StatusCode::BAD_REQUEST, "path")
    } else if request.uri().path() == "/status" && request.method() == Method::GET {
        Json(json!({"protocol":PROTOCOL,"active":service.active.load(Ordering::SeqCst),"draining":service.draining.load(Ordering::SeqCst),
            "accepted":service.accepted.load(Ordering::SeqCst).to_string(),"completed":service.completed.load(Ordering::SeqCst).to_string(),
            "rejected":service.rejected.load(Ordering::SeqCst).to_string()})).into_response()
    } else if service.draining.load(Ordering::SeqCst) {
        failure(StatusCode::SERVICE_UNAVAILABLE, "draining")
    } else if request.uri().path() == "/health" && request.method() == Method::GET {
        Json(json!({"protocol":PROTOCOL,"status":"ok"})).into_response()
    } else if request.uri().path() != "/v1/reports" {
        failure(StatusCode::NOT_FOUND, "path")
    } else if request.method() != Method::POST {
        failure(StatusCode::METHOD_NOT_ALLOWED, "method")
    } else {
        match service.permits.clone().try_acquire_owned() {
            Err(_) => {
                service.rejected.fetch_add(1, Ordering::SeqCst);
                failure(StatusCode::SERVICE_UNAVAILABLE, "capacity")
            }
            Ok(permit) => {
                service.active.fetch_add(1, Ordering::SeqCst);
                service.accepted.fetch_add(1, Ordering::SeqCst);
                let _accepted = Accepted {
                    service: service.clone(),
                    _permit: permit,
                };
                match tokio::time::timeout(service.timeout, report(request)).await {
                    Ok(response) => {
                        if response.status().is_success() {
                            service.completed.fetch_add(1, Ordering::SeqCst);
                        }
                        response
                    }
                    Err(_) => failure(StatusCode::REQUEST_TIMEOUT, "timeout"),
                }
            }
        }
    };
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
}

fn bounded(name: &str, default: usize, max: usize, zero: bool) -> Result<usize, ()> {
    let value = env::var(name).unwrap_or_else(|_| default.to_string());
    if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
        return Err(());
    }
    let value: usize = value.parse().map_err(|_| ())?;
    if value > max || (!zero && value == 0) {
        return Err(());
    }
    Ok(value)
}
async fn run() -> Result<(), ()> {
    let token = env::var("LONGHORN_NATIVE_TOKEN").map_err(|_| ())?;
    if !(32..=256).contains(&token.len())
        || !token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err(());
    }
    let host: IpAddr = env::var("LONGHORN_NATIVE_HOST")
        .unwrap_or_else(|_| "127.0.0.1".into())
        .parse()
        .map_err(|_| ())?;
    if !host.is_loopback() {
        return Err(());
    }
    let port = bounded("LONGHORN_NATIVE_PORT", 3020, 65535, true)? as u16;
    let maximum = bounded("LONGHORN_NATIVE_MAX_CONCURRENT", 16, 128, false)?;
    let timeout = bounded("LONGHORN_NATIVE_REQUEST_TIMEOUT_MS", 2000, 60000, false)?;
    let service = Arc::new(Service {
        token,
        permits: Arc::new(Semaphore::new(maximum)),
        timeout: Duration::from_millis(timeout as u64),
        draining: AtomicBool::new(false),
        active: AtomicUsize::new(0),
        accepted: AtomicU64::new(0),
        completed: AtomicU64::new(0),
        rejected: AtomicU64::new(0),
    });
    let listener = tokio::net::TcpListener::bind(SocketAddr::new(host, port))
        .await
        .map_err(|_| ())?;
    let address = listener.local_addr().map_err(|_| ())?;
    #[cfg(unix)]
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .map_err(|_| ())?;
    #[cfg(unix)]
    let mut interrupt = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())
        .map_err(|_| ())?;
    let shutdown_service = service.clone();
    let shutdown = async move {
        #[cfg(unix)]
        tokio::select! { _ = terminate.recv() => {}, _ = interrupt.recv() => {} }
        #[cfg(not(unix))]
        let _ = tokio::signal::ctrl_c().await;
        shutdown_service.draining.store(true, Ordering::SeqCst);
        shutdown_service.permits.close();
        println!("{}", json!({"message":"Native reports draining"}));
    };
    println!(
        "{}",
        json!({"message":"Native reports listening","url":format!("http://{address}"),"protocol":PROTOCOL})
    );
    axum::serve(
        listener,
        Router::new().fallback(dispatch).with_state(service.clone()),
    )
    .with_graceful_shutdown(shutdown)
    .await
    .map_err(|_| ())?;
    println!(
        "{}",
        json!({"message":"Native reports stopped","active":service.active.load(Ordering::SeqCst),"completed":service.completed.load(Ordering::SeqCst).to_string()})
    );
    Ok(())
}
#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    if run().await.is_err() {
        eprintln!("{{\"message\":\"Native reports startup or transport failed\"}}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn computes_ordered_bounded_reports() {
        assert_eq!(
            compute(Input {
                numbers: vec![2.0, -1.0, 9.0]
            }),
            Some(Report {
                count: 3,
                sum: 10.0,
                min: -1.0,
                max: 9.0
            })
        );
        assert_eq!(
            compute(Input {
                numbers: vec![1e12; 1000]
            })
            .unwrap()
            .sum,
            1e15
        );
        assert_eq!(
            compute(Input {
                numbers: vec![-0.0]
            })
            .unwrap()
            .min
            .to_bits(),
            0.0f64.to_bits()
        );
    }
    #[test]
    fn rejects_unbounded_or_ambiguous_input() {
        for numbers in [
            vec![],
            vec![0.0; 1001],
            vec![f64::NAN],
            vec![f64::INFINITY],
            vec![1e12 + 1.0],
        ] {
            assert!(compute(Input { numbers }).is_none());
        }
        for input in [
            r#"{"numbers":[1],"extra":true}"#,
            r#"{"numbers":[1],"numbers":[2]}"#,
            r#"{"numbers":["1"]}"#,
        ] {
            assert!(serde_json::from_str::<Input>(input).is_err());
        }
    }
}
