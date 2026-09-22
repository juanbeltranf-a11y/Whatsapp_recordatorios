const assert = require('assert');
const { formatSavedItemsList, normalizeString } = require('../src/savedItems');

console.log('🧪 === INICIANDO PRUEBAS UNITARIAS DE MEMORIA Y GUARDADO DE DATOS ===\n');

// Test 1: Normalización de texto
console.log('Test 1: Normalización de texto (acentos y mayúsculas)...');
assert.strictEqual(normalizeString('CÉDULA de la Vecina!'), 'cedula de la vecina!');
assert.strictEqual(normalizeString('Elvira Reyes'), 'elvira reyes');
console.log('  ✅ normalizeString funciona correctamente.');

// Test 2: Formateo de lista vacía
console.log('Test 2: Formateo de lista vacía...');
const emptyFormatted = formatSavedItemsList([]);
assert(emptyFormatted.includes('Aún no tienes ningún dato guardado'));
console.log('  ✅ Lista vacía muestra mensaje descriptivo y ejemplos.');

// Test 3: Formateo de lista con datos y notas de personas
console.log('Test 3: Formateo de lista con datos de personas, imágenes y enlaces...');
const mockItems = [
  {
    id: '1',
    type: 'text',
    description: 'Cédula de la vecina Elvira Reyes',
    content: '36155047\nElvira Reyes\nEs la cédula de la vecina',
    createdAt: new Date(),
  },
  {
    id: '2',
    type: 'text',
    description: 'Clave Wifi de la casa',
    content: 'Wifi_Casa_2026*',
    createdAt: new Date(),
  },
  {
    id: '3',
    type: 'image',
    description: 'Fachada de la oficina',
    content: 'image',
    createdAt: new Date(),
  },
  {
    id: '4',
    type: 'link',
    description: 'Portafolio web',
    content: 'https://miportafolio.com',
    createdAt: new Date(),
  },
];

const formatted = formatSavedItemsList(mockItems);
assert(formatted.includes('TUS DATOS Y ELEMENTOS GUARDADOS'));
assert(formatted.includes('Cédula de la vecina Elvira Reyes'));
assert(formatted.includes('36155047'));
assert(formatted.includes('Clave Wifi de la casa'));
assert(formatted.includes('Fachada de la oficina'));
assert(formatted.includes('https://miportafolio.com'));
console.log('  ✅ Formateo clasifica datos, notas, imágenes y enlaces a la perfección.');

console.log('\n🎉 ¡TODAS LAS PRUEBAS UNITARIAS DE MEMORIA PASARON EXITOSAMENTE!');
