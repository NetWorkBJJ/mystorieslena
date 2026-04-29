import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

type ProseProps = {
  children: string;
  className?: string;
  size?: "sm" | "base" | "lg";
};

export function Prose({ children, className, size = "base" }: ProseProps) {
  const sizeClass =
    size === "sm" ? "prose-sm" : size === "lg" ? "prose-lg" : "prose-base";

  return (
    <div
      className={cn(
        "prose prose-veludo max-w-none",
        sizeClass,
        "prose-headings:font-serif prose-headings:tracking-tight",
        "prose-h1:text-2xl prose-h1:mb-4 prose-h1:mt-6",
        "prose-h2:text-xl prose-h2:mb-3 prose-h2:mt-6",
        "prose-h3:text-lg prose-h3:mb-2 prose-h3:mt-5",
        "prose-h4:text-base prose-h4:mb-2 prose-h4:mt-4",
        "prose-p:leading-relaxed",
        "prose-li:my-1",
        "prose-strong:font-semibold",
        "prose-table:my-4 prose-th:text-left prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2",
        "prose-blockquote:not-italic prose-blockquote:font-normal",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
