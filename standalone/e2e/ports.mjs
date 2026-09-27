function parsePort(value, fallback, name) {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer from 1 through 65535`);
  }
  return port;
}

export function standaloneE2eEndpoints(env = process.env) {
  const productionPort = parsePort(env.STANDALONE_E2E_PORT, 4174, 'STANDALONE_E2E_PORT');
  const developmentPort = parsePort(env.STANDALONE_E2E_DEV_PORT, 4175, 'STANDALONE_E2E_DEV_PORT');
  if (productionPort === developmentPort) {
    throw new Error('Standalone production and development E2E ports must differ');
  }
  return {
    productionPort,
    developmentPort,
    productionOrigin: `http://127.0.0.1:${productionPort}`,
    developmentOrigin: `http://127.0.0.1:${developmentPort}`,
  };
}
