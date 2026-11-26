import { ashbyConnector, parseAshbyBoardName } from "./ashby";
import {
  extractStructuredJobsFromDocument,
  genericCareersConnector,
} from "./generic-careers";
import {
  greenhouseConnector,
  parseGreenhouseBoardToken,
} from "./greenhouse";
import { leverConnector, parseLeverSiteIdentifier } from "./lever";
import {
  isRestrictedAutomatedSourceUrl,
  manualImportConnector,
  parseManualJobImport,
  type ManualJobImportInput,
} from "./manual-import";
import {
  canonicalizeJobUrl,
  ConnectorError,
  sanitizeJobHtml,
  type ConnectorErrorCode,
  type ConnectorSourceType,
  type FetchBatch,
  type JobSourceConnector,
  type NormalizedJob,
  type SalaryPeriod,
  type SalarySourceType,
  type SourceConfig,
  type ValidationResult,
  type WorkplaceType,
} from "./types";

const CONNECTORS: Record<ConnectorSourceType, JobSourceConnector> = {
  greenhouse: greenhouseConnector,
  lever: leverConnector,
  ashby: ashbyConnector,
  generic_career_page: genericCareersConnector,
  manual: manualImportConnector,
};

/**
 * Returns the connector implementation for a supported `sourceType`.
 * Throws `ConnectorError("INVALID_CONFIG")` for unknown or unsupported source types.
 */
export function getConnectorForSourceType(sourceType: string): JobSourceConnector {
  const normalized = sourceType.trim().toLowerCase() as ConnectorSourceType;
  if (Object.prototype.hasOwnProperty.call(CONNECTORS, normalized)) {
    return CONNECTORS[normalized];
  }
  throw new ConnectorError(
    "INVALID_CONFIG",
    `Unsupported job source type: "${sourceType}".`,
    { retryable: false }
  );
}

/**
 * Validates a job source configuration against its connector's rules.
 */
export async function validateSourceConfig(
  config: SourceConfig
): Promise<ValidationResult> {
  try {
    const connector = getConnectorForSourceType(config.sourceType);
    return await connector.validate(config);
  } catch (err) {
    if (err instanceof ConnectorError) {
      return {
        valid: false,
        errorCode: err.code,
        errorMessage: err.message,
      };
    }
    throw err;
  }
}

export {
  ashbyConnector,
  canonicalizeJobUrl,
  ConnectorError,
  extractStructuredJobsFromDocument,
  genericCareersConnector,
  greenhouseConnector,
  isRestrictedAutomatedSourceUrl,
  leverConnector,
  manualImportConnector,
  parseAshbyBoardName,
  parseGreenhouseBoardToken,
  parseLeverSiteIdentifier,
  parseManualJobImport,
  sanitizeJobHtml,
};

export type {
  ConnectorErrorCode,
  ConnectorSourceType,
  FetchBatch,
  JobSourceConnector,
  ManualJobImportInput,
  NormalizedJob,
  SalaryPeriod,
  SalarySourceType,
  SourceConfig,
  ValidationResult,
  WorkplaceType,
};
