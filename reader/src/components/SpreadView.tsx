import PageView from "./PageView";
import type { LangMode, ReaderPage } from "../types";

interface Props {
  left: ReaderPage | null;
  right: ReaderPage | null;
  lang: LangMode;
  fontSize: number;
}

/** 双页跨页：左右两页并排 */
export default function SpreadView({ left, right, lang, fontSize }: Props) {
  return (
    <div className="spread">
      <div className="spread-half">
        {left ? (
          <PageView page={left} lang={lang} fontSize={fontSize} />
        ) : (
          <div className="page-image-empty">—</div>
        )}
      </div>
      <div className="spread-half">
        {right ? (
          <PageView page={right} lang={lang} fontSize={fontSize} />
        ) : (
          <div className="page-image-empty">—</div>
        )}
      </div>
    </div>
  );
}
