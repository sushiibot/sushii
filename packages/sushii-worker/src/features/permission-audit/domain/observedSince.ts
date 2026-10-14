import type { PermissionName } from "./PermissionUsage";
import type { PermissionUsageCoverage } from "./PermissionUsageCoverageRepository";
import { actionTypesFor } from "./detectors/AuditLogUsageDetector";

/**
 * Start of reliable history per tracked permission. With a finished
 * backfill, a permission is only as covered as its least-covered action type.
 */
export function observedSince(
  observed: Iterable<PermissionName>,
  coverage: PermissionUsageCoverage | null,
  now: Date,
): Map<PermissionName, Date> {
  const result = new Map<PermissionName, Date>();
  const trackingStart = coverage?.trackingStartedAt ?? now;

  for (const permission of observed) {
    const actionStarts = coverage?.backfilledAt
      ? actionTypesFor(permission).map(
          (action) =>
            coverage.backfillCoverage[String(action)] ?? trackingStart,
        )
      : [];

    const starts = actionStarts.length > 0 ? actionStarts : [trackingStart];
    result.set(
      permission,
      new Date(Math.max(...starts.map((date) => date.getTime()))),
    );
  }

  return result;
}
