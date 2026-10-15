import { call } from './handlers.ts';

// The one global the Kotlin side calls: sipwiseCall(name, argsJson) -> resultJson.
(globalThis as unknown as { sipwiseCall: typeof call }).sipwiseCall = call;
