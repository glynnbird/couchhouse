import { ChangesFollower, CloudantV1 } from '@ibm-cloud/cloudant'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { createClient } from '@clickhouse/client'
import { writeFile } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'

// the size of batches written to Clickhouse
const BATCH_SIZE = 100

// the buffer of unwritten changes
const batch = []

// the clickhouse client
let ch

// the last sequence token we know about
let lastSeq

// a Node.js stream transformer that takes a stream of individual
// changes and groups them into batches of BATCH_SIZE except the
// last batch which may be smaller.
const batcher = new Transform({
  readableObjectMode: true,
  writableObjectMode: true,
  transform(obj, _, callback) {

    // use id instead of _id and dump _rev
    obj.doc.id = obj.doc._id
    delete obj.doc._id
    delete obj.doc._rev

    // push the change into our batch array
    batch.push(obj)
    // if we have at least a full batch
    if (batch.length >= BATCH_SIZE) {
      // send a full batch to the next thing in the pipeline
      this.push(batch.splice(0, BATCH_SIZE))
    }
    callback()
  },
  flush(callback) {
    // handle the any remaining buffered data
    if (batch.length > 0) {
      // send anything left as a final batch
      this.push(batch)
    }
    callback()
  }
})

// another stream transformer that expects batches of data.
// It processes the batch of data and calls 'callback' when 
// its done. Any data it pushes to the next thing in pipeline
// must be text because the next thing is process.stdout!
const handler = new Transform({
  writableObjectMode: true,
  async transform(batch, _, callback) {
    // your custom code goes here
    if (batch.length > 0) {

      // write to the database
      await ch.insert({
        table: `couchhouse.${process.env.CLOUDANT_DATABASE}`,
        values: batch.map((i) => { return i.doc }), // array of docs
        clickhouse_settings: {
          // Allows to insert serialized JS Dates (such as '2023-12-06T10:54:48.000Z')
          date_time_input_format: 'best_effort',

          // allow clickhouse to group writes into bigger parts
          async_insert: true,
          wait_for_async_insert: false
        },
        format: 'JSONEachRow'
      })

      // write the lastSeq to a file
      lastSeq = batch[batch.length - 1].seq
      await saveLastSeq()
    }
    // do something with batch - an array of changes
    this.push(`process batch size ${batch.length} - ${lastSeq.slice(0, 20)}...\n`)
    callback()
  }
})

// calculate the filename where the state should be stored
const getStateFilename = () => {
  const db = process.env.CLOUDANT_DATABASE.replace(/[a-zA-Z0-9]/, '_')
  return `couchhouse_state_${process.env.CLOUDANT_DATABASE}.json`
}

// save the lastSeq for this database to a local file
const saveLastSeq = async () => {
  const fname = getStateFilename()
  const obj = {
    lastSeq
  }
  await writeFile(fname, JSON.stringify(obj))
}

// load the lastSeq value for this database from local file
const loadLastSeq = async () => {
  try {
    const fname = getStateFilename()
    console.log('Loading lastSeq from', fname)
    const contents = await readFile(fname, { encoding: 'utf8' })
    const obj = JSON.parse(contents)
    return obj.lastSeq
  } catch (err) {
    console.log('No state file found, assuming "0"')
    return '0'
  }
}

// entry point
const main = async () => {

  // don't try anything unless we have a Cloudant database name
  if (!process.env.CLOUDANT_DATABASE) {
    console.err('Missing env variable CLOUDANT_DATABASE')
    process.exit(1)
  }

  // load any previous state
  lastSeq = await loadLastSeq()
  console.log('Starting changes feed from ', lastSeq.slice(0,20, '...'))

  // https://clickhouse.com/docs/en/integrations/language-clients/javascript#configuration
  // create a Clickhouse client
  ch = createClient({
    url: 'http://127.0.0.1:8123'
  })

  // create a cloudant-node-sdk client - configuration via env variables
  const client = CloudantV1.newInstance({})

  // create a Cloudant ChangesFollower, starting from the beginning of the
  // database's changes feed with the document body included.
  const changesParams = {
    db: process.env.CLOUDANT_DATABASE,
    since: lastSeq,
    includeDocs: true
  }
  const changesFollower = new ChangesFollower(client, changesParams)

  // start the changes feed - which generates a stream of changes
  const changesItemsStream = changesFollower.start()

   // create a simple pipeling
  // changes->batcher->handler->stdout
  pipeline(
    changesItemsStream,
    batcher,
    handler,
    process.stdout)
    .then(() => {
      console.log('Stopped')
    })
    .catch((err) => {
      console.log(err)
    })
}

main()
