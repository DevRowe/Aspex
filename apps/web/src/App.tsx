import { useEffect } from "react";
import { Inbox } from "./components/Inbox";
import { connect } from "./lib/hubClient";

export function App() {
  useEffect(() => {
    let disposed = false;
    let stream: EventSource | undefined;

    void connect().then((nextStream) => {
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
