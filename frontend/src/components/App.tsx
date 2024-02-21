import React, { useState } from 'react';
import { Amplify, Auth } from 'aws-amplify';
import { withAuthenticator } from '@aws-amplify/ui-react';
import useWebSocket from 'react-use-websocket';
import ReactMarkdown from 'react-markdown';
import '@aws-amplify/ui-react/styles.css';
import './App.css';
import lens from './assets/lens.png';
import spinner from './assets/spinner.gif';

const REGION = 'us-east-1';
const USER_POOL_ID = 'us-east-1_POyd1xvtJ';
const USER_POOL_WEB_CLIENT_ID = '6rq1t7ke88tmf256ujd103b8s2';
const API_ENDPOINT = 'wss://z830t9oz24.execute-api.us-east-1.amazonaws.com/dev/';

Amplify.configure({
  Auth: {
    mandatorySignIn: true,
    region: REGION,
    userPoolId: USER_POOL_ID,
    userPoolWebClientId: USER_POOL_WEB_CLIENT_ID,
  },
});

function App() {
  const [prompt, setPrompt] = useState(undefined);
  const [loading, setLoading] = useState(false);
  const [conversation, setConversation] = useState([]);

  const { lastJsonMessage, sendJsonMessage, readyState } = useWebSocket(API_ENDPOINT, {
    onOpen: () => {
      console.log('WebSocket connection established.');
    },
    onMessage(event) {
      if (event.data != 'End') {
        // Indicates no more tokens
        if (!event.data.includes('Endpoint request timed out')) {
          // Exclude APIGateway timeout message
          // setAnswer(answer + event.data);

          setConversation([
            ...conversation,
            {
              text: event.data,
              type: 'answer',
            },
          ]);
        }
      } else {
        setLoading(false);
      }
    },
    share: true,
    filter: () => false,
    retryOnError: true,
    shouldReconnect: () => true,
  });

  const sendPrompt = async (event) => {
    if (event.key !== 'Enter') {
      return;
    }
    setLoading(true);
    sendJsonMessage({
      action: 'ask',
      data: prompt,
      token: (await Auth.currentSession()).getIdToken().getJwtToken(),
    });
    setConversation([
      ...conversation,
      {
        text: prompt,
        type: 'question',
      },
    ]);

    setPrompt('');
  };

  return (
    <div className="app">
      <div id="chatborder">
        <div id="chatbox">
          {conversation.reverse().map((item, index) => (
            <p key={`${'chatmsg' + index}`} className={`${item.type == 'question' ? 'question' : 'answer'}`}>
              {item.text}
            </p>
          ))}
        </div>

        <div className="chatwrapper">
          <input
            type="text"
            name="prompt"
            id="prompt"
            disabled={loading}
            className="chatinput"
            style={{
              backgroundImage: loading ? `url(${spinner})` : `url(${lens})`,
            }}
            placeholder="Hi there! Type here to talk to me."
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => sendPrompt(e)}
          />
        </div>
      </div>

      {/* <div className="app-container">
        <div>
          {conversation.reverse().map((item, index) => (
            <div>{item.text}</div>
          ))}
        </div>

        {/* <div className="answer">
          <ReactMarkdown>{answer}</ReactMarkdown>
        </div>

        <div className="spotlight__wrapper">
          <input
            type="text"
            className="spotlight__input"
            placeholder="Ask me anything..."
            style={{
              backgroundImage: `url(${lens})`,
              width: '100%',
            }}
            disabled={loading}
            style={{
              backgroundImage: loading ? `url(${spinner})` : `url(${lens})`,
            }}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => sendPrompt(e)}
          />
        </div>
      </div> */}
    </div>
  );
}

export default withAuthenticator(App);
