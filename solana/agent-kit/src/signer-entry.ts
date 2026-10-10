#!/usr/bin/env -S node --import tsx
import { signerMain } from './signer-main';
import { safeError } from './config';
signerMain(process.argv.slice(2)).then(result => { if (result) console.log(JSON.stringify(result, null, 2)); }).catch(error => { console.error(`error: ${safeError(error)}`); process.exitCode = 1; });
