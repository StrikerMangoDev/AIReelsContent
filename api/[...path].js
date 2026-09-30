import { createApp } from '../server/http/app.js'
import { repository } from '../server/bootstrap.js'
import { sources } from '../server/config/sources.js'
export default createApp({ repository, sources })
