import { describe, it, expect, vi } from 'vitest';

vi.mock('groq-sdk', () => {
  const Groq = vi.fn(() => ({
    chat: {
      completions: {
        create: vi.fn(() => Promise.resolve({
          choices: [{
            message: {
              content: 'Hola, soy un vendedor de ASOFERRU Urabá. ¿En qué puedo ayudarte hoy?'
            }
          }]
        }))
      }
    }
  }));
  return { default: Groq, Groq };
});

describe('server.js', () => {
  it('should start without crashing', async () => {
    const server = await import('./server.js');
    expect(server).toBeDefined();
  });
});
