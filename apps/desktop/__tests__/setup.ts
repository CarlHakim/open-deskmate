/**
 * Vitest setup file for tests
 * Configures testing-library matchers and global test utilities
 */

import '@testing-library/jest-dom/vitest';

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// Extend global types for test utilities
declare global {
  // Add any global test utilities here if needed
}

export {};
