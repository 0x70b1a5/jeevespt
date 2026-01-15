// Suppress console.log during tests to keep output clean
// Comment out individual lines below to re-enable specific console methods for debugging

const originalConsole = { ...console };

beforeAll(() => {
  global.console = {
    ...console,
    log: jest.fn(),
    // Keep error and warn for debugging actual issues
    // error: jest.fn(),
    // warn: jest.fn(),
  };
});

afterAll(() => {
  global.console = originalConsole;
});
