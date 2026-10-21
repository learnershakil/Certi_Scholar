import type { Metadata } from "next";
import { Workbench } from "./components/workbench";

export const metadata: Metadata = {
  title: "Academic Integrity & Consistency | CertiScholar",
  description:
    "Recalculates academic marks and compares them with supplied printed values.",
};

export default function AcademicVerificationPage() {
  return <Workbench />;
}