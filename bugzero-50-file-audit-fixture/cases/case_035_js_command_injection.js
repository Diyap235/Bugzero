const { exec } = require("node:child_process");
function run(name) {
  exec("report-tool " + name);
}
module.exports = { run };
