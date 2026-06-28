import { useEffect } from "react";
import { Inbox } from "./components/Inbox";
import { connect } from "./lib/hubClient";
import { usePreviewStore, usePreviews } from "./preview/usePreviews";

export function App() {
  usePreviews();

  useEffect(() => {
    let disposed = false;
    let stream: EventSource | undefined;

    void connect({
      onPreview: usePreviewStore.getState().upsertPreview,
    }).then((nextStream) => {
      if (disposed) {
        nextStream.close();
        return;
      }

      stream = nextStream;
    });

    return () => {
      disposed = true;
      stream?.close();
    };
  }, []);

  return <Inbox />;
}
