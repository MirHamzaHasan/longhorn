import type { Longhorn } from '@longhorn/core'
export type ConsoleAssets={readonly script:string;readonly style:string}
const document=(passwordChanges:boolean,sessionControls:boolean,sessionInventory:boolean)=>`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>LongHorn Console</title><link rel="stylesheet" href="/console/app.css"><script type="module" src="/console/app.js"></script></head>
<body data-password-changes="${passwordChanges}" data-session-controls="${sessionControls}" data-session-inventory="${sessionInventory}"><a class="skip" href="#main">Skip to content</a><header class="topbar"><a class="brand" href="#/commands"><span class="monogram" aria-hidden="true">L</span>LongHorn<span class="brand-note">Console</span></a><div class="account-tools"><span id="identity"></span><button id="theme" class="quiet" type="button">Dark theme</button><button id="logout" class="quiet" type="button" hidden>Sign out</button></div></header><div class="shell"><aside id="sidebar" hidden><nav aria-label="Main navigation"><a href="#/commands" data-nav="commands">Commands</a><a href="#/new" data-nav="new">Create command</a><a href="#/account" data-nav="account">Account</a><div id="operator-nav" hidden><p class="nav-label">Operations</p><a href="#/deliveries" data-nav="deliveries">Deliveries</a><a href="#/audit" data-nav="audit">Recovery audit</a></div></nav><p class="sidebar-note">Follow a command from submission to receipt.</p></aside><div class="workspace"><p id="notice" role="status" aria-live="polite" hidden></p><main id="main" tabindex="-1" aria-busy="true"><h1>Opening the console</h1><p>Checking your session.</p></main><footer>LongHorn · Command operations</footer></div></div><noscript><p>Turn on JavaScript to use the command console.</p></noscript></body></html>`
export function configureConsole(app:Longhorn,assets:ConsoleAssets,options:{readonly passwordChanges?:boolean;readonly sessionControls?:boolean;readonly sessionInventory?:boolean}={}):void{
  app.http.use('/console*',async(c,next)=>{
    c.header('Cache-Control','no-store');c.header('X-Content-Type-Options','nosniff');c.header('Referrer-Policy','no-referrer')
    c.header('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
    await next()
  })
  for(const path of ['/console','/console/'])app.http.get(path,c=>c.html(document(options.passwordChanges===true,options.sessionControls===true,options.sessionInventory===true)))
  app.http.get('/console/app.js',c=>{c.header('Content-Type','text/javascript; charset=utf-8');return c.body(assets.script)})
  app.http.get('/console/app.css',c=>{c.header('Content-Type','text/css; charset=utf-8');return c.body(assets.style)})
}
