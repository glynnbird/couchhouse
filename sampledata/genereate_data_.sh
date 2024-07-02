#!/bin/bash

while 
  # generate some data every 2 seconds
  # using iot.json as the template, generate 100 sample docs, 1 per line and
  # feed them into couchimport to put them in the "iot" database
  cat iot.json | datamaker -i 1200 -f json | couchimport --db $CLOUDANT_DATABASE --type jsonl
  # wait
  sleep 2
  ( true )
do
  :
done
