const assert = require('assert');
const { parseHeuristicReminder } = require('../src/groq');

console.log('🧪 === INICIANDO PRUEBAS DE FLUJO CONVERSACIONAL DE MEMORIA Y DATOS ===\n');

// Caso exacto reportado por el usuario:
console.log('Test 1: Detección de guardado de datos personales (Cédula de la vecina)...');
const inputSave = `Guardame estos datos:
36155047
Elvira Reyes

Es la cedula de la vecina`;

const resultSave = parseHeuristicReminder(inputSave);
assert(resultSave !== null, 'Debe detectarse como save_item');
assert.strictEqual(resultSave.intent, 'save_item');
assert.strictEqual(resultSave.itemType, 'text');
console.log(`  ✅ Intent detectado: ${resultSave.intent}, tipo: ${resultSave.itemType}, descripción: "${resultSave.description}"`);

console.log('Test 2: Detección de consulta de lista de datos guardados...');
const inputList = 'Que datos me tienes guardados?';
const resultList = parseHeuristicReminder(inputList);
assert(resultList !== null, 'Debe detectarse como list_items');
assert.strictEqual(resultList.intent, 'list_items');
console.log(`  ✅ Intent detectado: ${resultList.intent}`);

console.log('Test 3: Detección de preguntas sobre datos específicos guardados...');
const inputGet1 = 'Cual es la cedula de la vecina?';
const resultGet1 = parseHeuristicReminder(inputGet1);
assert(resultGet1 !== null, 'Debe detectarse como get_item');
assert.strictEqual(resultGet1.intent, 'get_item');
assert(resultGet1.query.toLowerCase().includes('cedula') || resultGet1.query.toLowerCase().includes('vecina'));
console.log(`  ✅ Intent: ${resultGet1.intent}, query: "${resultGet1.query}"`);

const inputGet2 = 'Pasame los datos de Elvira';
const resultGet2 = parseHeuristicReminder(inputGet2);
assert(resultGet2 !== null);
assert.strictEqual(resultGet2.intent, 'get_item');
console.log(`  ✅ Intent: ${resultGet2.intent}, query: "${resultGet2.query}"`);

console.log('Test 4: Detección de eliminación de datos guardados...');
const inputDelete = 'Borra el dato de la vecina';
const resultDelete = parseHeuristicReminder(inputDelete);
assert(resultDelete !== null);
assert.strictEqual(resultDelete.intent, 'delete_item');
assert(resultDelete.query.toLowerCase().includes('vecina'));
console.log(`  ✅ Intent: ${resultDelete.intent}, target a borrar: "${resultDelete.query}"`);

console.log('\n🎉 ¡TODAS LAS PRUEBAS DE FLUJO DE MEMORIA PASARON AL 100%!');
