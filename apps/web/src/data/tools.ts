export type Tool = {
  slug: string;
  title: string;
  shortDescription: string;
  category: string;
  tier: 'free' | 'premium';
  tags: string[];
  duration: string;
};

export const tools: Tool[] = [
  {
    slug: 'meta-prompt-arquitecto',
    title: 'Meta-prompt del arquitecto',
    shortDescription: 'Un prompt maestro para que el agente diseñe la arquitectura antes de escribir una sola línea.',
    category: 'Prompts',
    tier: 'free',
    tags: ['arquitectura', 'planificación'],
    duration: '8 min',
  },
  {
    slug: 'agente-investigador',
    title: 'Agente investigador de mercado',
    shortDescription: 'Cómo montar un agente que investiga competencia y arma un reporte accionable en 10 minutos.',
    category: 'Agentes',
    tier: 'free',
    tags: ['research', 'competencia'],
    duration: '14 min',
  },
  {
    slug: 'workflow-triage-tickets',
    title: 'Triage automático de tickets',
    shortDescription: 'Workflow que clasifica, prioriza y asigna tickets nuevos usando un agente y reglas de negocio.',
    category: 'Workflows',
    tier: 'premium',
    tags: ['productividad', 'automatización'],
    duration: '22 min',
  },
  {
    slug: 'code-review-agentico',
    title: 'Code review agéntico',
    shortDescription: 'Un pipeline que hace review de PRs con estándares específicos de tu equipo antes que un humano.',
    category: 'Agentes',
    tier: 'premium',
    tags: ['dev', 'code review'],
    duration: '19 min',
  },
  {
    slug: 'prompt-editorial',
    title: 'Prompt editorial de largo aliento',
    shortDescription: 'Estructura para generar contenido largo con voz consistente y sin caer en el tono genérico de LLM.',
    category: 'Prompts',
    tier: 'premium',
    tags: ['contenido', 'escritura'],
    duration: '11 min',
  },
  {
    slug: 'sub-agentes-especializados',
    title: 'Sub-agentes especializados',
    shortDescription: 'Patrón para descomponer tareas complejas en sub-agentes con roles claros que se coordinan entre sí.',
    category: 'Agentes',
    tier: 'premium',
    tags: ['patrones', 'arquitectura'],
    duration: '26 min',
  },
  {
    slug: 'prompt-debug',
    title: 'Prompt para debug quirúrgico',
    shortDescription: 'Cómo pedirle a un agente que encuentre root causes en vez de parchar síntomas.',
    category: 'Prompts',
    tier: 'premium',
    tags: ['dev', 'debug'],
    duration: '9 min',
  },
  {
    slug: 'evaluar-outputs',
    title: 'Framework para evaluar outputs',
    shortDescription: 'Cómo medir si un agente está haciendo bien su trabajo, en vez de "me parece que sí".',
    category: 'Workflows',
    tier: 'premium',
    tags: ['evals', 'calidad'],
    duration: '17 min',
  },
];
