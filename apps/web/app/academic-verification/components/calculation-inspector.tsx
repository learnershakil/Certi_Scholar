"use client";

import { useState } from "react";
import { formatMarks, formatPercentage } from "../../../lib/academic/display";
import type { RecordEnvelope } from "../../../lib/academic/types";
import panels from "../panels.module.css";
import styles from "../workbench.module.css";
import { ChevronDownIcon, ChevronUpIcon, InfoIcon } from "./icons";
import { Panel } from "./panel";
import { placeholderText, type ResultView } from "./result-view";

interface CalculationInspectorProps {
  envelope: RecordEnvelope;
  view: ResultView;
}

export function CalculationInspector({
  envelope,
  view,
}: CalculationInspectorProps) {
  const [open, setOpen] = useState(false);
  const { record } = envelope;
  const isReady = view.phase === "ready";
  const result = isReady ? view.result : undefined;
  const calculated = result?.calculated;

  const obtainedExpression = record.subjects
    .map((mark) => formatMarks(mark.obtained))
    .join(" + ");
  const maximumExpression = record.subjects
    .map((mark) => formatMarks(mark.maximum))
    .join(" + ");

  return (
    <Panel id="inspector" title="Arithmetic Trace">
      <div className={panels.inspectorAccordion}>
        <button
          type="button"
          className={panels.inspectorToggle}
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-controls="inspector-body"
        >
          <div className={panels.inspectorToggleLeft}>
            <InfoIcon className={panels.inspectorToggleIcon} />
            <span className={panels.inspectorToggleText}>
              {open ? "Hide Arithmetic Trace" : "Inspect Step-by-Step Arithmetic Trace"}
            </span>
          </div>
          {open ? (
            <ChevronUpIcon className={styles.inlineIconSm} />
          ) : (
            <ChevronDownIcon className={styles.inlineIconSm} />
          )}
        </button>

        {open ? (
          <div id="inspector-body" className={panels.detailsBody}>
            {/* 1. Arithmetic Formula Derivations */}
            <section className={panels.group}>
              <div className={panels.groupHead}>
                <h4 className={panels.groupTitle}>Step-by-Step Mathematical Derivation</h4>
              </div>

              {calculated ? (
                <div className={panels.traceStack}>
                  <div className={panels.traceRow}>
                    <span className={panels.traceName}>Total Obtained Sum:</span>
                    <code className={panels.traceCalc}>
                      &Sigma; Obtained = {obtainedExpression} &rarr;{" "}
                      <strong>{formatMarks(calculated.totalObtained)}</strong>
                    </code>
                  </div>

                  <div className={panels.traceRow}>
                    <span className={panels.traceName}>Total Maximum Sum:</span>
                    <code className={panels.traceCalc}>
                      &Sigma; Maximum = {maximumExpression} &rarr;{" "}
                      <strong>{formatMarks(calculated.totalMaximum)}</strong>
                    </code>
                  </div>

                  <div className={panels.traceRow}>
                    <span className={panels.traceName}>Percentage Derivation:</span>
                    <code className={panels.traceCalc}>
                      ({formatMarks(calculated.totalObtained)} &divide;{" "}
                      {formatMarks(calculated.totalMaximum)}) &times; 100 &rarr;{" "}
                      <strong>{formatPercentage(calculated.percentage)}</strong>
                    </code>
                  </div>

                  {record.printedTotal !== undefined && (
                    <div className={panels.traceRow}>
                      <span className={panels.traceName}>Total Comparison:</span>
                      <code className={panels.traceCalc}>
                        |{formatMarks(calculated.totalObtained)} &minus;{" "}
                        {formatMarks(record.printedTotal)}| ={" "}
                        {Math.abs(calculated.totalObtained - record.printedTotal).toFixed(4)}{" "}
                        (Tolerance: &le; 0.01)
                      </code>
                    </div>
                  )}

                  {record.printedPercentage !== undefined && (
                    <div className={panels.traceRow}>
                      <span className={panels.traceName}>Percentage Comparison:</span>
                      <code className={panels.traceCalc}>
                        |{formatPercentage(calculated.percentage)} &minus;{" "}
                        {formatPercentage(record.printedPercentage)}| ={" "}
                        {Math.abs(calculated.percentage - record.printedPercentage).toFixed(4)}{" "}
                        (Tolerance: &le; 0.01)
                      </code>
                    </div>
                  )}
                </div>
              ) : (
                <p className={panels.placeholder}>
                  {isReady ? "No calculation returned by engine." : `${placeholderText(view)}.`}
                </p>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}