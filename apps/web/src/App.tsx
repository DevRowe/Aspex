import { useEffect } from "react";
import { Inbox } from "./components/Inbox";
import { connect } from "./lib/hubClient";

export function App() {
  useEffect(() => {
    let stream: EventSource | undefined;
    void connect().then((nextStream) => {
      stream = nextStream;
    });

    return () => {
      stream?.close();
    };
  }, []);

  return <Inbox />;
}
