import { Handler } from 'aws-lambda';
import { decode, verify } from 'jsonwebtoken';
import { promisify, TextEncoder } from 'util';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import jwksRsa from 'jwks-rsa';
import { BedrockAgentRuntimeClient, RetrieveAndGenerateCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import crypto from 'crypto';
import { DynamoDB } from 'aws-sdk';

const dynamodb = new DynamoDB();

const textEncoder = new TextEncoder();

const JWKS_URI = process.env.JWKS_URI ? process.env.JWKS_URI : '';
const API_GW_ENDPOINT = process.env.API_GW_ENDPOINT;
const ISSUER = process.env.ISSUER;
const AUDIENCE = process.env.AUDIENCE ? process.env.AUDIENCE : '';

const bedrock = new BedrockAgentRuntimeClient({ region: process.env.AWS_REGION });

const apiGwManApiClient = new ApiGatewayManagementApiClient({
  region: process.env.AWS_REGION,
  endpoint: API_GW_ENDPOINT,
});

const client = jwksRsa({
  cache: true,
  rateLimit: true,
  jwksUri: JWKS_URI,
});

export const getSigningKey = promisify(client.getSigningKey);

let connectionId: string;
let prompt: string;

async function verifyToken(token: string, publicKey: string, audience: string) {
  console.log(`Verify token`);
  await verify(token, publicKey, {
    audience: AUDIENCE,
    issuer: ISSUER,
  });
  console.log(`Verified the token for ${audience}`);
}

function decodeToken(token: string) {
  console.log(`Decode token`);
  const decoded = decode(token, { complete: true });
  console.log(`Decoded token ${JSON.stringify(decoded)}`);
  if (!decoded || !decoded.header || !decoded.header.kid) {
    throw new Error('Invalid token');
  }
  return decoded;
}

async function authorize(token: string): Promise<boolean> {
  try {
    console.log(token);
    const decodedToken = decodeToken(token);
    const signingKey = await getSigningKey(decodedToken.header.kid);

    if (signingKey) {
      const publicKey = signingKey.getPublicKey();
      let verified = false;
      const audience = AUDIENCE;

      try {
        await verifyToken(token, publicKey, audience);
        console.log(`Verified the token for ${audience}`);
        verified = true;
      } catch (err) {
        console.error('Token not verified', err);
        return false;
      }

      if (verified) {
        return true;
      }
    }
  } catch (err) {
    console.error('Token not verified', err);
    return false;
  }
  return false;
}

async function processPrompt(prompt: string, connectionId: string) {
  console.log('Calling Bedrock');

  let dynamo_params = {
    TableName: 'bedrock_sessions',
    KeyConditionExpression: 'connectionid = :connectionid',
    ExpressionAttributeValues: {
      ':connectionid': { S: connectionId },
    },
  };

  let bedrock_sessionid = null;
  dynamodb.query(dynamo_params, (err, data) => {
    if (err) {
      console.log('Error', err);
    } else {
      console.log('Query succeeded.');
      if (data && data.Items && data.Items.length > 0) {
        data.Items.forEach(function (item) {
          console.log('Item:', item);
          bedrock_sessionid = item.bedrock_sessionid;
        });
      }
    }
  });

  var params = {
    input: {
      text: prompt,
    },
    retrieveAndGenerateConfiguration: {
      type: 'KNOWLEDGE_BASE' /* required */,
      knowledgeBaseConfiguration: {
        knowledgeBaseId: 'JD6EOVOZMZ' /* required */,
        modelArn:
          'arn:aws:bedrock:' + process.env.AWS_REGION + '::foundation-model/anthropic.claude-instant-v1' /* required */,
      },
    },
  };

  if (bedrock_sessionid) {
    params['sessionId'] = bedrock_sessionid;
  }

  const command = new RetrieveAndGenerateCommand(params);
  const response = await bedrock.send(command);

  console.log('Bedrock response:');
  console.log(response);

  await apiGwManApiClient.send(
    new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: textEncoder.encode(response['output']['text']),
    }),
  );

  await apiGwManApiClient.send(
    new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: textEncoder.encode('End'),
    }),
  );

  dynamo_params = {
    TableName: 'bedrock_sessions',
    Item: {
      connectionid: {
        S: connectionId,
      },
      bedrock_sessionid: {
        S: response.sessionId,
      },
      ttl: {
        N: (Date.now() + 1000 * 60 * 60 * 24 * 7).toString(),
      },
    },
  };

  await dynamodb.putItem(dynamo_params).promise();
}

export const handler: Handler = async (event: any, context: any) => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  connectionId = event.requestContext.connectionId;
  const routeKey = event.requestContext.routeKey;

  console.log(`Connection id ${connectionId}`);
  console.log(`Route key ${routeKey}`);

  switch (routeKey) {
    case '$connect': {
      console.log('$connect');
      prompt = 'Hello!';
      break;
    }
    case '$disconnect': {
      console.log('$disconnect');
      prompt = 'Bye!';
      break;
    }
    case 'ask': {
      console.log('ask');
      const requestData = JSON.parse(event.body);
      const token = requestData.token;
      const isAuthorized = await authorize(token);
      if (!isAuthorized) {
        console.log('Not Authorized');
        return;
      } else {
        console.log('Authorized');
        prompt = requestData.data;

        await processPrompt(prompt, connectionId);
      }
      break;
    }
    default: {
      console.log('default');
      break;
    }
  }

  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
    body: '{}',
  };
};
