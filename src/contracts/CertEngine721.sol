// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract CertEngine721 is ERC721, Ownable {
    error OwnershipRenounceDisabled();
    error ZeroFamily();
    error ZeroReceiver();
    error AlreadyMinted();

    event CertifiedTokenMinted(address indexed owner, bytes32 indexed familyId, uint256 indexed tokenId);

    constructor(address initialOwner) ERC721("Cert Engine 721", "CE721") Ownable(initialOwner) {}

    function renounceOwnership() public pure override {
        revert OwnershipRenounceDisabled();
    }

    function mintCertified(bytes32 familyId, address receiver) external onlyOwner returns (uint256) {
        if (familyId == bytes32(0)) revert ZeroFamily();
        if (receiver == address(0)) revert ZeroReceiver();
        uint256 tokenId = uint256(familyId);
        if (_ownerOf(tokenId) != address(0)) revert AlreadyMinted();

        _mint(receiver, tokenId);
        emit CertifiedTokenMinted(receiver, familyId, tokenId);
        return tokenId;
    }
}
