"use client";

import Link from "next/link";
import { useState } from "react";
import shell from "../shell.module.css";
import { ChevronDownIcon, ChevronUpIcon, InfoIcon } from "./icons";

export function PageHeader() {
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  return (
    <header className={shell.header}>
      <nav aria-label="Breadcrumb">
        <ol className={shell.crumbs}>
          <li>
            <Link href="/" className={shell.crumbLink}>
              CertiScholar
            </Link>
          </li>
          <li>
            <span aria-current="page" className={shell.crumbActive}>
              Academic Verification
            </span>
          </li>
        </ol>
      </nav>

      <div className={shell.headerMain}>
        <div className={shell.headerTitleGroup}>
          <div className={shell.titleRow}>
            <h1 className={shell.title}>Academic Integrity &amp; Consistency</h1>
          </div>
        </div>

        <button
          type="button"
          className={shell.helpToggle}
          onClick={() => setShowHowItWorks((prev) => !prev)}
          aria-expanded={showHowItWorks}
          aria-controls="how-it-works-panel"
        >
          <InfoIcon className={shell.helpIcon} />
          <span>{showHowItWorks ? "Close" : "How it works"}</span>
          {showHowItWorks ? (
            <ChevronUpIcon className={shell.chevronIcon} />
          ) : (
            <ChevronDownIcon className={shell.chevronIcon} />
          )}
        </button>
      </div>

      {showHowItWorks ? (
        <div
          id="how-it-works-panel"
          className={shell.howItWorksPanel}
          role="region"
          aria-label="Consistency Verdict Reference"
        >
          <div className={shell.howItWorksGrid}>
            <div className={shell.howItWorksCol}>
              <h3 className={shell.howItWorksHeading}>CONSISTENT</h3>
              <p className={shell.howItWorksText}>
                Calculated sums reconcile with printed document totals within 0.01 tolerance.
              </p>
            </div>
            <div className={shell.howItWorksCol}>
              <h3 className={shell.howItWorksHeading}>INCONSISTENT</h3>
              <p className={shell.howItWorksText}>
                Discrepancy detected between printed and calculated values.
              </p>
            </div>
            <div className={shell.howItWorksCol}>
              <h3 className={shell.howItWorksHeading}>NEEDS_REVIEW</h3>
              <p className={shell.howItWorksText}>
                Printed values omitted or subject mark validation anomaly.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
