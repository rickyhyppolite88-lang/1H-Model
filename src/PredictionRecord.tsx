import ActualPredictionRecord from "./ActualPredictionRecord";
import Lab from "./Lab";
import { preferenceRecordSource, usePreference } from "./usePreference";

export default function PredictionRecord() {
  const [source, setSource] = usePreference(
    "record.source",
    preferenceRecordSource,
    "actual",
  );
  return (
    <>
      <fieldset
        className="record-source-toggle"
        aria-label="Prediction record source"
      >
        <button
          type="button"
          aria-pressed={source === "actual"}
          onClick={() => setSource("actual")}
        >
          Actual
        </button>
        <button
          type="button"
          aria-pressed={source === "lab"}
          onClick={() => setSource("lab")}
        >
          Lab
        </button>
      </fieldset>
      {source === "actual" ? <ActualPredictionRecord /> : <Lab recordOnly />}
    </>
  );
}
