## Neqto Cockpit

### Description
Neqto Cockpit is a web application that allows administrators (and us employees) to view the network traffic Neqto is generating.

The goal is to have a visualisation that shows (based on balls, the size and speed depends on the amount of data and the speed of the data) the network traffic

### Technologies
Our current stack is as followed:
- Golang backend
- Angular frontend
- PostgreSQL database (Each tenant has its own database)
- Redis for caching
- SQS for message queuing

We want to keep the stack as it is, though we are going to introduce a couple more technologies for this module.

### Technologies to be introduced
- Pixi.js for the frontend

### Architecture
In our golang neqto backend, we are going to capture more detailed web traffic data. This data is going to be stored in the database as time series data. The data may stay in the database for one month. (suggestion to use table partitioning of 1 day, after 1 month the partition can be deleted day by day)

### Requirements
- [ ] Neqto should be able to capture more detailed web traffic data:
    - ttfb in ms
    - payload size in bytes
    - response code
    - response size in bytes
    - name of the flow that executed this request
    - current date and time (unix timestamp UTC)
    - user agent that triggered the flow (if not scheduled)
    - ip address of the user that triggered the flow (if not scheduled)
    - flow execution id
- [ ] Neqto should then allow a SSE connection to the backend to receive the data in real time
- [ ] Neqto should send the old data from "today" as well (so the frontend can show a timeline, but prioritise the live data)
- [ ] The backend SSE connection should have a small buffer, to prevent the frontend from receiving too much data at once
- [ ] The live data could be visualised within 1 second of the actual data
- [ ] the live data must be visualised within 10 seconds of the actual data
- [ ] The data format should be NDJSON, each event one json object
- [ ] The data stream should be compressed (brotli or gzip)
- [ ] When the frontend is requesting data snapshots, it is delivered in NDJSON format as well
- [ ] When the frontend is connecting to the SSE endpoint midday, it will receive "historical" and live data mixed. The historical data (for that day) is streamed as fast as possible, whilst live events will be injected when they occur.
- [ ] The frontend (when loading the page) should automatically pin the play header to the "live data"
- [ ] When the backend is streaming the historical data, it should be send from most recent to oldest, this way the end user can see what just happens, before what happens an hour or two ago.
- [ ] The frontend may pause the stream, either automatically or by user action. The backend should be able to resume the stream when the frontend resumes.
- [ ] the frontend needs to be able to scrub through the timeline, the user can pickup the "current" play header, and move it left to go back in time, or right to go forward in time. The backend should keep sending live data to the frontend, so the frontend's play bar can show the user there is new data. Comparible to a youtube video, where you can scrub through the timeline, and all the data that is available has a slightly different color. indicating it is "downloaded"
- [ ] the frontend needs to be able to request specific data snapshots from the backend, as when the client is lagging, the frontend needs to prune the data it has in memory. When the user then scrolls back to a specific area, the frontend will need to re-request said data.
    - recommended is to implement a rolling buffer in the frontend based on the client performance. If the browser's memory consumption exceeds a certain threshold, the frontend should decrease the buffer size and prune the oldest memory it has stored.
- [ ] The frontend should have a "previous" and "next" button, to navigate through the dates.
- [ ] upon opening the sse connection the backend should hint the frontend of the current date and time (UTC) and the current available data range (UTC)
- [ ] the frontend should (when viewing old data) play the data as if it was live data
- [ ] when the user clicks on a ball, the frontend should show a small info box about that request:
    - http status code + definition of the status code
    - nice to have: context of the request (e.g. if it was an update, show the id/uuid/guid, if it was a list show the "entity" name)
    - destination url
- [ ] in the info box, the user may click on "advanced info", this will extend the box and show the following:
    - ttfb in ms
    - payload size in bytes
    - response size in bytes
- [ ] When the backend is streaming the data, it should prioritise the data in the following order:
    1. {"id": "019c0def-caf8-7817-9341-f98f0b942971", "ts": 1769760344824, "destination": "bol.com", "flow": "my-flow", "flow_execution_id": "98-1761116764768886932", "trigger_ua": "Postman/1.0", "trigger_ip": "127.0.0.1"}
        - note, even though id is uuid v7, it is still send as int, to prevent the frontend from having to parse bulk uuids.
        - we send all the available/generic data first
    2. {"id": "019c0def-caf8-7817-9341-f98f0b942971", "payload_size": 1024, "ttfb-hint": 139}
        - because the payload size calculation can be quite heavy, we split this into a separate event
        - using historical data, the backend sends a hint of the usual ttfb in ms
    3. {"id": "019c0def-caf8-7817-9341-f98f0b942971", "ttfb": 300, "response_size": 1024, "response_code": 200}
        - once the backend has received the response, we can calculate the ttfb, response size and response code
        - the backend will automatically send a timedout event if the response takes longer than 15 minutes
- [ ] The frontend visualisation must prioritise the fps staying above 30, ideally 60
- [ ] the frontend visualisation must have a client budget, to prevent the frontend from using too much memory,cpu,gpu
- [ ] the NDJSON stream should be opened by a webworker, to prevent the main thread from being blocked
 