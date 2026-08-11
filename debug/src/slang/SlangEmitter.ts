const supportedCaptureTypes = new Set(["float", "float2", "float3", "float4", "int", "bool", "float2x2"]);

export function emitSlangFloat4(typeName: string, expression: string): string {
  assertSupportedCaptureType(typeName);
  switch (typeName) {
    case "float":
      return `float4(${expression}, ${expression}, ${expression}, 1.0)`;
    case "float2":
      return `float4(${expression}, 0.0, 1.0)`;
    case "float3":
      return `float4(${expression}, 1.0)`;
    case "float4":
      return expression;
    case "int":
      return `float4(float(${expression}), float(${expression}), float(${expression}), 1.0)`;
    case "bool":
      return `float4(${expression} ? 1.0 : 0.0, ${expression} ? 1.0 : 0.0, ${expression} ? 1.0 : 0.0, 1.0)`;
    case "float2x2":
      return `float4(${expression}[0][0], ${expression}[0][1], ${expression}[1][0], ${expression}[1][1])`;
    default:
      throw new Error(`Unsupported Slang debug capture type '${typeName}'.`);
  }
}

export function emitSlangStatic(typeName: string, name: string): string {
  assertSupportedCaptureType(typeName);
  return `static ${typeName} ${name};`;
}

function assertSupportedCaptureType(typeName: string): void {
  if (!supportedCaptureTypes.has(typeName)) {
    throw new Error(`Unsupported Slang debug capture type '${typeName}'.`);
  }
}
