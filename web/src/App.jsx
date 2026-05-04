import { Route, Switch } from "wouter";
import Landing from "./pages/Landing.jsx";
import Workspace from "./pages/Workspace.jsx";

export default function App() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/w/:id">{(params) => <Workspace id={params.id} />}</Route>
      <Route>
        <NotFound />
      </Route>
    </Switch>
  );
}

function NotFound() {
  return (
    <div className="h-full flex items-center justify-center text-ink-500">
      Page not found ·{" "}
      <a className="ml-1 text-brand-600 underline" href="/">
        Go home
      </a>
    </div>
  );
}
