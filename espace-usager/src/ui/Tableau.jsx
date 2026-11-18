/** Tableau défilant horizontalement sur petit écran. Les lignes sont passées en enfants (<tr>). */
export function Tableau({ entetes, children }) {
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            {entetes.map((e, i) => (
              <th key={i}>{e}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const Mono = ({ children }) => <span className="mono">{children}</span>;
