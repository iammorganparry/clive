import type React from "react";
import type { EligibleFile } from "./branch-changes.js";
import { FileText } from "lucide-react";
import { truncateMiddle } from "../../../utils/path-utils.js";

interface FileTestRowProps {
  file: EligibleFile;
  onViewTest?: (testFilePath: string) => void;
  onPreviewDiff?: (test: unknown) => void;
}

const FileTestRow: React.FC<FileTestRowProps> = ({
  file,
  onViewTest: _onViewTest,
  onPreviewDiff: _onPreviewDiff,
}) => {
  const isEligible = file.isEligible;
  const tooltipText = isEligible
    ? file.path
    : `${file.path}${file.reason ? ` - ${file.reason}` : ""}`;

  return (
    <div
      className={`flex items-center gap-1.5 ${!isEligible ? "opacity-50" : ""}`}
      title={tooltipText}
    >
      <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
      <span className="text-xs font-mono w-4 flex-shrink-0 text-muted-foreground">
        {file.status}
      </span>
      <span
        className={`text-sm flex-1 truncate ${
          isEligible ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        {truncateMiddle(file.relativePath)}
      </span>
      {!isEligible && (
        <span className="text-xs text-muted-foreground italic">
          (ineligible)
        </span>
      )}
    </div>
  );
};

export default FileTestRow;
