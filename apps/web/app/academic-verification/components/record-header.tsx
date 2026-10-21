import type { RecordEnvelope } from "../../../lib/academic/types";
import { ActionBar } from "./action-bar";
import { PageHeader } from "./page-header";

export interface RecordHeaderProps {
  envelope: RecordEnvelope | undefined;
  samples: readonly RecordEnvelope[];
  pendingSampleId: string;
  lastCheckedAt?: string | undefined;
  loading: boolean;
  onChooseSample: (id: string) => void;
  onLoadSample: () => void;
  onRun: () => void;
  onReset: () => void;
}

export function RecordHeader({
  envelope,
  samples,
  pendingSampleId,
  loading,
  onChooseSample,
  onLoadSample,
  onRun,
  onReset,
}: RecordHeaderProps) {
  return (
    <>
      <PageHeader />
      <ActionBar
        envelope={envelope}
        samples={samples}
        pendingSampleId={pendingSampleId}
        loading={loading}
        onChooseSample={onChooseSample}
        onLoadSample={onLoadSample}
        onRun={onRun}
        onReset={onReset}
      />
    </>
  );
}

export { PageHeader, ActionBar };