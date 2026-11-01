#!/usr/bin/env node
// Usage: node tests/run-node.js
var path = require('path');
var TPC = require(path.join(__dirname, '..', 'js', 'core.js'));
var suite = require(path.join(__dirname, 'tests.js'));
var res = suite(TPC)(function (line) { console.log(line); });
process.exit(res.failed ? 1 : 0);
