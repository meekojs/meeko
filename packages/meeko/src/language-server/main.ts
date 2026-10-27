#!/usr/bin/env node
import { runLanguageServer } from "./server.js";

runLanguageServer(process.argv.slice(2));
