const vscode = require('vscode');
const { exec } = require('child_process');

function activate(context) {
  let disposable = vscode.commands.registerCommand('klyn.healthCheck', () => {
    exec('curl -s http://localhost:3000/status', (err, stdout) => {
      if (err) {
        vscode.window.showErrorMessage('Klyn AI OS is not reachable');
      } else {
        vscode.window.showInformationMessage(`Klyn AI OS: ${stdout}`);
      }
    });
  });
  context.subscriptions.push(disposable);
}

function deactivate() {}
module.exports = { activate, deactivate };
