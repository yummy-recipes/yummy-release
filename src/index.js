import express from "express"
import { Octokit } from "@octokit/rest"
import { verifyWebhookSignature } from '@hygraph/utils'
import debounce from "lodash.debounce"

const app = express()

const secret = process.env.HYGRAPH_SECRET
const GITHUB_TOKEN = process.env.GITHUB_TOKEN

const octokit = new Octokit({
  auth: GITHUB_TOKEN,
})

const triggerRelease = debounce(async () => {
  try {
    await octokit.rest.actions.createWorkflowDispatch({
      owner: 'yummy-recipes',
      repo: 'yummy-next',
      workflow_id: 'deploy.yml',
      ref: 'master'
    })
  } catch (e) {
    console.error(e)
  }
}, 30000)

app.post('/', (req, res) => {
  const body = req.body || ''
  const signature = req.headers['gcms-signature'] || ''

  let isValid = false
  try {
    isValid = Boolean(process.env.HYGRAPH_SECRET_BYPASS) || verifyWebhookSignature({ body, signature, secret });
  } catch (e) {
    console.error(e);
  }

  if (!isValid) {
    return res.status(401).send('Invalid signature');
  }

  triggerRelease()
  res.send("OK")
})

const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})
