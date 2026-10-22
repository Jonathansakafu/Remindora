/**
 * "About" content shared by web, desktop and Android.
 * Source: Jonathan Sakafu's portfolio (github.com/Jonathansakafu/portfolio).
 */
export const creator = {
  name: 'Jonathan Sakafu',
  role: 'Full-Stack Developer',
  headline: 'Builds AI-powered products end to end.',
  bio: 'From AI trading platforms to endpoint security systems — I design, build, and ship full-stack applications across web, mobile, and native desktop.',
  philosophy: 'I like building things that solve a real, specific problem — then getting them in front of real users.',
  highlights: [
    { title: 'Full-stack by default', text: 'Comfortable owning a product from database schema to deployed UI — frontend, backend, and everything wiring them together.' },
    { title: 'AI-native products', text: 'I build with LLMs as a core part of the product, not a bolt-on — retrieval-augmented generation, tool-calling, and real-time signal fusion.' },
    { title: 'Ships across platforms', text: 'Web, native mobile (Capacitor/Android), and native desktop (.NET/C#) — picking the right platform for what the product actually needs.' },
  ],
  skills: [
    { category: 'Frontend', items: ['React', 'Next.js', 'Tailwind CSS', 'TypeScript'] },
    { category: 'Backend', items: ['Node.js', 'Express', 'Prisma', 'REST APIs'] },
    { category: 'Data', items: ['MongoDB', 'PostgreSQL', 'Vector search / RAG'] },
    { category: 'AI', items: ['Groq', 'Gemini', 'LLM tool-calling', 'Embeddings'] },
    { category: 'Mobile & Native', items: ['Capacitor', 'C# / .NET', 'Android'] },
    { category: 'DevOps', items: ['Vercel', 'Render', 'GitHub Actions', 'Docker'] },
  ],
  projects: [
    { name: 'TradeMind AI', tagline: 'AI-powered forex & crypto trading journal', url: 'https://trade-mind-ai-seven.vercel.app' },
    { name: 'MalmegaVille Sentinel', tagline: 'Personal endpoint security platform', url: 'https://app-production-fd2d.up.railway.app' },
    { name: 'Sanitation Services & Tracking System', tagline: 'Multi-operator service dispatch platform', url: 'https://backend-production-344e.up.railway.app' },
    { name: 'Academic Management System', tagline: 'Full-featured school management system', url: 'https://academic-management-system-xi.vercel.app' },
  ],
  contact: {
    email: 'jonathansakafu@gmail.com',
    whatsapp: '+255674462833',
    github: 'https://github.com/jonathansakafu',
    linkedin: 'https://www.linkedin.com/in/jonathan-sakafu-42108635a',
    portfolio: 'https://portfolio-seven-dun-d8pz65t7l6.vercel.app',
  },
} as const;

export const aboutApp = {
  name: 'Remindora',
  summary: 'Remindora helps you capture tasks instantly, plan your time, build habits, focus deeply and get priority-aware reminders on every device — web, desktop and Android, synced in real time.',
};
