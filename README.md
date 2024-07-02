# couchhouse

A simple data-warehousing tool that takes data from a Cloudant database into a Clickhouse table, to take advantage of Clickhouse's superior querying capabilities.

This tool is best suited for data:

- that is write-only e.g. IoT data
- that is time-series e.g. IoT data
- that has a fixed schema with documents that only contain top-level attributes.
- where the database contains only one document type.

The `couchhouse` application spools the changes from Cloudant into Clickhouse, writing data in batches and can run indefinitely copying live changes as they arrive. If the `couchhouse` process restarts, it will resume from where it left off in the changes feed.

## Prerequisites

1. A Cloudant instance hosting a database.
2. A Clickhouse instance, and a Clickhouse client that can conntect to it.
3. A machine capable of running `couchhouse` that can see and has permission to access (1) & (2).

## Setting up the Clickhouse table

Create a Clickhouse database called `couchhouse`:

```sql
CREATE DATABASE 'couchhouse'
```

Then create a Clickhouse table in that database that matches the schema of your data e.g.

```sql
CREATE TABLE IF NOT EXISTS couchhouse.iot
(
  device_id   LowCardinality(String),
  id          UUID,
  type        LowCardinality(String),
  ts          DateTime,
  temperature Float32,
  inclination Int8,
  latitude    Float32,
  longitude   Float32,
  fuel        UInt8,
  status      LowCardinality(String)
)
ENGINE ReplacingMergeTree()
PRIMARY KEY (device_id, ts)
ORDER BY (device_id, ts, id)
```

Note:

- the table name `couchhouse.iot` is the Clickhouse database name and the Cloudant database name we will be using.
- the `id` field will contain each document's `_id` value.
- the other fields must match the schema of your top-level document attributes.
- we use `LowCardinality(string)` for strings that contain few distinct values.
- we use the `ReplacingMergeTree` database engine so that if the Cloudant changes feed _rewinds_, then the duplicate changes will be de-duped by Clickhouse.
- the `PRIMARY KEY` is a combination of our device id and the time of the reading. The choice of primary key is the biggest decision to be made and the whys and wherefores of this process is beyond the scope of this document.
- the `ORDER BY` is the `PRIMARY KEY` plus the document id at the end, which is required for deduping using the `ReplacingMergeTree`. (the `ORDER BY` must be a equal or a super-set of the `PRIMARY KEY`)

## Running

Set [environment variables](https://github.com/IBM/cloudant-node-sdk?tab=readme-ov-file#authentication-with-environment-variables) according to your authentication preference and run `npm run start`. We use `CLOUDANT_DATABASE` to define which Cloudant database to use:

```sh
export CLOUDANT_URL="https://MYCLOUDANT.cloudant.com"
export CLOUDANT_APIKEY="MY_API_KEY"
# define the database that contains the data to be copied to Clickhouse       
export CLOUDANT_DATABASE="iot"
cd couchhouse
npm run start
```

The `couchhouse` process is will spool any data in the "iot" database into Clickhouse and wait for more to arrive.

## Creating dummy data

We can create some artificial Cloudant data in another terminal:

```sh
cd sampledata
export COUCH_URL="https://MYUSER:MYPASSWORD@MYCLOUDANT.com"
export CLOUDANT_DATABASE="iot"
./generate_data.sh
```

> This assumes the presence of [Datamaker](https://www.npmjs.com/package/datamaker) which can be installed with `npm install -g datamaker` and [couchimport](https://www.npmjs.com/package/couchimport) which is installed with `npm install -g couchimport`.

## Query the data in Clickhouse

```sql
 SELECT COUNT() FROM couchhouse.iot;
   ┌─COUNT()─┐
1. │   33000 │
   └─────────┘
1 row in set. Elapsed: 0.004 sec. 
```

