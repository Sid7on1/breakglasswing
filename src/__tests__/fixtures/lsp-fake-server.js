#!/usr/bin/env node
// Minimal fake LSP server fixture for the C1 client test. Implements the initialize
// handshake, publishes one diagnostic on didOpen, and answers textDocument/references.
const rpc = require('vscode-jsonrpc/node');

const connection = rpc.createMessageConnection(
  new rpc.StreamMessageReader(process.stdin),
  new rpc.StreamMessageWriter(process.stdout)
);

connection.onRequest('initialize', () => ({
  capabilities: { textDocumentSync: 1, referencesProvider: true },
}));
connection.onNotification('initialized', () => { /* ready */ });

connection.onNotification('textDocument/didOpen', (params) => {
  connection.sendNotification('textDocument/publishDiagnostics', {
    uri: params.textDocument.uri,
    diagnostics: [{
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
      severity: 1,
      message: 'fixture diagnostic: undefined symbol',
    }],
  });
});
connection.onNotification('textDocument/didChange', () => { /* no-op */ });

connection.onRequest('textDocument/references', (params) => ([
  { uri: params.textDocument.uri, range: { start: { line: 5, character: 2 }, end: { line: 5, character: 8 } } },
  { uri: params.textDocument.uri, range: { start: { line: 9, character: 4 }, end: { line: 9, character: 10 } } },
]));

connection.onRequest('shutdown', () => null);
connection.onNotification('exit', () => process.exit(0));

connection.listen();
