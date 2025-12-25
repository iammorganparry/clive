import type React from "react";
import type { EligibleFile } from "./branch-changes.js";
import { FileText } from "lucide-react";
import { truncateMiddle } from "../../../utils/path-utils.js";

interface FileTestRowProps {
  file: EligibleFile;
  chatContext?: {
    exists: boolean;
    messageCount: number;
    status: string | null;
  };
  onViewTest?: (testFilePath: string) => void;
  onPreviewDiff?: (test: unknown) => void;
}

const FileTestRow: React.FC<FileTestRowProps> = ({
  file,
  chatContext: _chatContext,
  onViewTest: _onViewTest,
  onPreviewDiff: _onPreviewDiff,
}) => {
  return (
    <div className="flex items-center gap-2">
      <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
      <span className="text-xs font-mono w-4 flex-shrink-0 text-muted-foreground">
        {file.status}
      </span>
      <span
        className="text-sm flex-1 truncate text-muted-foreground"
        title={file.path}
      >
        {truncateMiddle(file.relativePath)}
      </span>
    </div>
  );
};

export default FileTestRow;
