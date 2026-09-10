const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const defaultKey = process.env.GROQ_API_KEY || '';

  if (defaultKey) {
    await prisma.config.upsert({
      where: { key: 'GROQ_API_KEY' },
      update: {},
      create: {
        key: 'GROQ_API_KEY',
        value: defaultKey,
      },
    });
    console.log('Seed completed: GROQ_API_KEY is configured.');
  } else {
    console.log('Seed skipped: No GROQ_API_KEY provided in environment.');
  }
}

main()
  .catch((e) => {
    console.error('Error in seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
