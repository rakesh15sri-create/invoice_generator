import { forwardRef, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fileSrc } from '../api.js';
import { hexToSoft } from '../data.js';
import { TEMPLATE_COMPONENTS } from '../templates/index.js';

const PAPER_W = 794; // A4 width at 96dpi

// Renders the selected template on an A4 sheet, scaled down to fit the available width.
const Preview = forwardRef(function Preview({ inv }, paperRef) {
  const wrapRef = useRef(null);
  const [fit, setFit] = useState({ scale: 1, height: 'auto' });
  const Template = TEMPLATE_COMPONENTS[inv.template] || TEMPLATE_COMPONENTS.confirm;
  // Templates just use company.logo as an <img> src; resolve stored (ImageKit) logos here.
  const shown = useMemo(() => {
    const logo = fileSrc(inv.company.logo);
    return logo === inv.company.logo ? inv : { ...inv, company: { ...inv.company, logo } };
  }, [inv]);

  useLayoutEffect(() => {
    const measure = () => {
      const wrap = wrapRef.current, paper = paperRef.current;
      if (!wrap || !paper) return;
      const gutter = window.innerWidth <= 900 ? 0 : 48;
      const scale = Math.min(1, (wrap.clientWidth - gutter) / PAPER_W);
      setFit({ scale, height: paper.offsetHeight * scale });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrapRef.current);
    ro.observe(paperRef.current);
    return () => ro.disconnect();
  }, [paperRef]);

  return (
    <section className="preview-wrap" ref={wrapRef}>
      <div className="preview-scale" style={{ transform: `scale(${fit.scale})`, height: fit.height }}>
        <div
          ref={paperRef}
          className="paper"
          style={{ '--accent': inv.accent, '--accent-soft': hexToSoft(inv.accent) }}
        >
          <Template inv={shown} />
        </div>
      </div>
    </section>
  );
});

export default Preview;
