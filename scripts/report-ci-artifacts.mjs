import { appendFile } from 'node:fs/promises'

const [kind,verificationValue,uploadValue,artifactId='',...extra]=process.argv.slice(2)
const outcomes=new Set(['success','failure','cancelled','skipped'])
const verification=verificationValue||'skipped',upload=uploadValue||'skipped'
if(!['console','application'].includes(kind)||!outcomes.has(verification)||!outcomes.has(upload)||(artifactId!==''&&!/^[1-9]\d{0,19}$/.test(artifactId))||extra.length)throw new Error('Invalid CI artifact report arguments')
const label=kind==='console'?'Browser console':'Independent application'
const produced=upload==='success'&&artifactId!==''
const availability=produced?`Uploaded artifact ${artifactId}; see this run’s artifacts.`:upload==='failure'?'Unavailable: upload failed. See the upload step’s error.':'No artifact was produced.'
const summary=`### ${label}\n\nVerification: **${verification}**. Upload outcome: **${upload}**. Artifact produced: **${produced?'yes':'no'}**.\n\n${availability}\n\nArtifact upload is optional; verification failures remain blocking. Local review outputs can be regenerated using the documented gates.\n`
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,summary)
console.log(`${label}: verification=${verification}; upload=${upload}; produced=${produced}`)
if(upload==='failure')console.log('::warning::Review artifact upload failed. Verification has its own result; inspect the upload error and use the local packaging/capture instructions if needed.')
