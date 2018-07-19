'use strict'

var ballot = `pragma solidity ^0.4.0;
contract Ballot {

    struct Voter {
        uint256 weight;
        bool voted;
        uint8 vote;
        address delegate;
    }
    struct Proposal {
        uint256 voteCount;
    }

    address chairperson;
    mapping(address => Voter) voters;
    Proposal[] proposals;

    /// Create a new ballot with $(_numProposals) different proposals.
    constructor(uint8 _numProposals) public {
        chairperson = msg.sender;
        voters[chairperson].weight = 1;
        proposals.length = _numProposals;
    }

    /// Give $(toVoter) the right to vote on this ballot.
    /// May only be called by $(chairperson).
    function giveRightToVote(address toVoter) public {
        if (msg.sender != chairperson || voters[toVoter].voted) return;
        voters[toVoter].weight = 1;
    }

    /// Delegate your vote to the voter $(to).
    function delegate(address to) public {
        Voter storage sender = voters[msg.sender]; // assigns reference
        if (sender.voted) return;
        while (voters[to].delegate != address(0) && voters[to].delegate != msg.sender)
            to = voters[to].delegate;
        if (to == msg.sender) return;
        sender.voted = true;
        sender.delegate = to;
        Voter storage delegateTo = voters[to];
        if (delegateTo.voted)
            proposals[delegateTo.vote].voteCount += sender.weight;
        else
            delegateTo.weight += sender.weight;
    }

    /// Give a single vote to proposal $(toProposal).
    function vote(uint8 toProposal) public {
        Voter storage sender = voters[msg.sender];
        if (sender.voted || toProposal >= proposals.length) return;
        sender.voted = true;
        sender.vote = toProposal;
        proposals[toProposal].voteCount += sender.weight;
    }

    function winningProposal() public constant returns (uint8 _winningProposal) {
        uint256 winningVoteCount = 0;
        for (uint8 prop = 0; prop < proposals.length; prop++)
            if (proposals[prop].voteCount > winningVoteCount) {
                winningVoteCount = proposals[prop].voteCount;
                _winningProposal = prop;
            }
    }
}`

var ballotTest = `pragma solidity ^0.4.7;
import "./assert.sol";
import "./ballot.sol";

contract test3 {
   
    Ballot ballotToTest;
    function beforeAll() public {
       ballotToTest = new Ballot(2);
    }
    
    function checkWinningProposal () public {
        ballotToTest.vote(1);
        Assert.equal(ballotToTest.winningProposal(), uint256(1), "1 should be the winning proposal");
    }
    
    function checkWinninProposalWithReturnValue () public constant returns (bool) {
        return ballotToTest.winningProposal() == 1;
    }
}
`

// @rv: fix the bug for IELE
const assert = `pragma solidity ^0.4.7;
library Assert {
  event AssertionEvent(
    bool passed,
    string message
  );
  function ok(bool a, string message) public returns (bool result) {
    result = a;
    emit AssertionEvent(result, message);
  }
  function equal(uint256 a, uint256 b, string message) public returns (bool result) {
    result = (a == b);
    emit AssertionEvent(result, message);
  }
  function equal(int256 a, int256 b, string message) public returns (bool result) {
    result = (a == b);
    emit AssertionEvent(result, message);
  }
  function equal(bool a, bool b, string message) public returns (bool result) {
    result = (a == b);
    emit AssertionEvent(result, message);
  }
  // TODO: only for certain versions of solc
  //function equal(fixed a, fixed b, string message) public returns (bool result) {
  //  result = (a == b);
  //  AssertionEvent(result, message);
  //}
  // TODO: only for certain versions of solc
  //function equal(ufixed a, ufixed b, string message) public returns (bool result) {
  //  result = (a == b);
  //  AssertionEvent(result, message);
  //}
  function equal(address a, address b, string message) public returns (bool result) {
    result = (a == b);
    emit AssertionEvent(result, message);
  }
  function equal(bytes32 a, bytes32 b, string message) public returns (bool result) {
    result = (a == b);
    emit AssertionEvent(result, message);
  }
  // TODO: needs to be convert to bytes first to be comparable
  //function equal(string a, string b, string message) public returns (bool result) {
  //  result = (a == b);
  //  AssertionEvent(result, message);
  //}
  function notEqual(uint256 a, uint256 b, string message) public returns (bool result) {
    result = (a != b);
    emit AssertionEvent(result, message);
  }
  function notEqual(int256 a, int256 b, string message) public returns (bool result) {
    result = (a != b);
    emit AssertionEvent(result, message);
  }
  function notEqual(bool a, bool b, string message) public returns (bool result) {
    result = (a != b);
    emit AssertionEvent(result, message);
  }
  // TODO: only for certain versions of solc
  //function notEqual(fixed a, fixed b, string message) public returns (bool result) {
  //  result = (a != b);
  //  AssertionEvent(result, message);
  //}
  // TODO: only for certain versions of solc
  //function notEqual(ufixed a, ufixed b, string message) public returns (bool result) {
  //  result = (a != b);
  //  AssertionEvent(result, message);
  //}
  function notEqual(address a, address b, string message) public returns (bool result) {
    result = (a != b);
    emit AssertionEvent(result, message);
  }
  function notEqual(bytes32 a, bytes32 b, string message) public returns (bool result) {
    result = (a != b);
    emit AssertionEvent(result, message);
  }
  // TODO: needs to be convert to bytes first to be comparable
  //function notEqual(string a, string b, string message) public returns (bool result) {
  //  result = (a != b);
  //  AssertionEvent(result, message);
  //}
}
`

module.exports = {
  ballot: { name: 'ballot.sol', content: ballot },
  ballot_test: { name: 'ballot_test.sol', content: ballotTest },
  assert: {name: 'assert.sol', content: assert }
}
