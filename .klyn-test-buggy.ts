// Buggy code with an undefined variable
function greet(name) {
  console.log(`Hello, ${naam}!`); // Typo: 'naam' instead of 'name'
}

greet('World');
console.log('Done!');