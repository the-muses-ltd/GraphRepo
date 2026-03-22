import neo4j, { type Driver, type Session } from "neo4j-driver";
import type { Config } from "../config.js";

let driver: Driver | null = null;

export const getDriver = (config: Config["neo4j"]): Driver => {
  if (!driver) {
    driver = neo4j.driver(
      config.uri,
      neo4j.auth.basic(config.username, config.password)
    );
  }
  return driver;
};

export const getSession = (config: Config["neo4j"]): Session => {
  return getDriver(config).session({ database: config.database });
};

export const withSession = async <T>(
  config: Config["neo4j"],
  fn: (session: Session) => Promise<T>
): Promise<T> => {
  const session = getSession(config);
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
};

export const closeDriver = async (): Promise<void> => {
  if (driver) {
    await driver.close();
    driver = null;
  }
};
