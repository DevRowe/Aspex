import { useEffect } from "react";
import { Inbox } from "./components/Inbox";
import { connect } from "./lib/hubClient";

export function App() {
  useEffect(() => {
    const stream = connect();
    return () => {
      stream.close();
    };
  }, []);

  return <Inbox />;
}
