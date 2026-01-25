import { Button } from "@clive/ui/button";
import { useState } from "react";

const CHAR_LIMIT = 250;

export const UserMessageText = ({ text }: { text: string }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const shouldTruncate = text.length > CHAR_LIMIT;

  if (!shouldTruncate) return <span>{text}</span>;

  const displayText = isExpanded ? text : `${text.slice(0, CHAR_LIMIT)}...`;

  return (
    <span>
      {displayText}
      <Button
        variant="link"
        size="sm"
        onClick={() => setIsExpanded(!isExpanded)}
        className="ml-1 h-auto p-0 text-xs"
      >
        {isExpanded ? "show less" : "read more"}
      </Button>
    </span>
  );
};
