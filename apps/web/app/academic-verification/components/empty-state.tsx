import shell from "../shell.module.css";
import { DocumentTextIcon } from "./icons";
import { Panel } from "./panel";

interface EmptyStateProps {
  onLoadFirstSample?: () => void;
}

export function EmptyState({ onLoadFirstSample }: EmptyStateProps) {
  return (
    <Panel id="waiting" title="Academic Verification Workspace">
      <div className={shell.emptyWorkspace}>
        <div className={shell.emptyIconCircle}>
          <DocumentTextIcon className={shell.emptyIcon} />
        </div>
        <h3 className={shell.emptyHeading}>No Academic Record Loaded</h3>
        {onLoadFirstSample ? (
          <button
            type="button"
            className={shell.buttonPrimary}
            onClick={onLoadFirstSample}
            style={{ marginTop: 12 }}
          >
            Load Sample Record 1
          </button>
        ) : null}
      </div>
    </Panel>
  );
}