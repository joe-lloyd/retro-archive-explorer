import type { StructuredAsset } from '../../../shared/types';

export function StructuredViewer({ asset }: { asset: StructuredAsset }) {
  return (
    <div className="structured-viewer">
      <div className="structured-head">
        <h2 className="structured-format">{asset.format}</h2>
        <p className="structured-summary">{asset.summary}</p>
      </div>

      {asset.sections.map((section, i) => (
        <div key={i} className="structured-section">
          <h3 className="structured-title">{section.title}</h3>
          <table className="structured-table">
            <tbody>
              {section.fields.map((field, j) => (
                <tr key={j}>
                  <td className="structured-label">{field.label}</td>
                  <td className="structured-value">{field.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {asset.text !== undefined && (
        <div className="structured-section">
          <h3 className="structured-title">Decoded text</h3>
          <pre className="text-content">{asset.text || '(no printable text)'}</pre>
        </div>
      )}
    </div>
  );
}
