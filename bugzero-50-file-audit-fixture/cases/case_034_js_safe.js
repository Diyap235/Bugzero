function greet(input) {
  const name = String(input ?? "").trim().slice(0, 80);
  return `Hello ${name}`;
}
module.exports = { greet };
