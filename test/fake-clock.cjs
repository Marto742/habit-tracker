// Preloaded into the server by the tests (node --require): the clock starts at FAKE_NOW and keeps
// ticking, and a test moves it by sending { now } over IPC (see setNow in helpers.js).
const RealDate = Date
let offset = RealDate.parse(process.env.FAKE_NOW) - RealDate.now()

process.on('message', message => {
  if (!message?.now) return
  offset = RealDate.parse(message.now) - RealDate.now()
  process.send({ nowSet: message.now })
})

globalThis.Date = class extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(RealDate.now() + offset)
    else super(...args)
  }

  static now() {
    return RealDate.now() + offset
  }
}
